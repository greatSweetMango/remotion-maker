#!/usr/bin/env node
/**
 * TM-153 follow-up — "hybrid" prompt-diet bench.
 *
 * Initial bench (tm-153-prompt-diet-bench.mjs):
 *   - diet variant was too aggressive (subject + 1 style hint only) → judge
 *     score dropped 25pts. Latency only -2s. Verdict: don't ship full diet.
 *
 * This run tests a HYBRID: keep the user's full prompt + answers exactly as
 * they enter the pipeline today, but drop the redundant "Style: friendly
 * cartoon illustration, transparent background, soft colors, centered
 * composition." boilerplate suffix (88 chars of generic style instructions
 * that overlap with quality='low' defaults).
 *
 * Hypothesis: -88 chars × 3 prompts is small relative to user content
 * (176-222 chars), so latency delta may be marginal. But the suffix is
 * redundant — every prompt gets the same generic adjective bag. If judge
 * score holds within ±5 of the long baseline, this is a safe diet.
 *
 * Cost: 3 more low-tier calls + 3 gpt-4o judge calls ≈ $0.045.
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

const ASSET_DIR = path.join(ROOT, '.spike-assets', 'TM-153');
fs.mkdirSync(path.join(ASSET_DIR, 'hybrid'), { recursive: true });
const REPORT_DIR = path.join(ROOT, 'wiki', '05-reports', 'screenshots', 'TM-153');
fs.mkdirSync(REPORT_DIR, { recursive: true });

const BUDGET_USD = 0.10;
const PRICE = { textIn: 5, imgIn: 10, imgOut: 40 };
const STATIC = 0.011;

// Hybrid: user prompt + answers KV, NO "Style: …" suffix.
function buildPromptHybrid(prompt, answers) {
  const answerText = answers && Object.keys(answers).length > 0
    ? ' ' + Object.entries(answers).map(([k, v]) => `${k}: ${v}`).join(', ')
    : '';
  return `${prompt}${answerText}`;
}

const FIXTURES = [
  { id: 'bear', prompt: '곰돌이가 초원을 걸어가는 약 10초분량의 횡스크롤 애니메이션 만들어줘',
    answers: { style: '동화풍 파스텔 일러스트', palette: '따뜻한 파스텔', mood: '행복하고 평화로움', text_overlay: '없음' } },
  { id: 'puppy', prompt: '강아지가 공원에서 뛰어가는 8초 애니메이션',
    answers: { style: '귀여운 카툰', palette: '밝은 초록', mood: '활기찬', camera: '횡스크롤' } },
  { id: 'robot', prompt: 'robot dancing in cyber city, 6 seconds',
    answers: { style: 'neon synthwave', palette: 'magenta and cyan', mood: 'energetic', text_overlay: 'none' } },
];

async function judgeImage(client, pngBytes, originalPrompt) {
  const b64 = pngBytes.toString('base64');
  const resp = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are a strict visual judge. Score 0-100 for: (1) subject_match — does the image clearly depict the requested subject; (2) style_quality — overall aesthetic polish. Return strict JSON: {"subject_match":N,"style_quality":N,"overall":N,"notes":"<<50 chars>"}.' },
      { role: 'user', content: [
        { type: 'text', text: `User prompt: ${originalPrompt}\nScore the image.` },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}`, detail: 'low' } },
      ]},
    ],
    response_format: { type: 'json_object' }, max_tokens: 200,
  });
  try { return JSON.parse(resp.choices[0].message.content); } catch { return { error: 'parse' }; }
}

function priceFromUsage(u) {
  if (!u) return null;
  const t = u.input_tokens_details?.text_tokens ?? 0;
  const i = u.input_tokens_details?.image_tokens ?? 0;
  const o = u.output_tokens ?? 0;
  return { cost: (t*PRICE.textIn + i*PRICE.imgIn + o*PRICE.imgOut)/1_000_000 };
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const results = [];
let running = 0;

for (const f of FIXTURES) {
  if (running + STATIC > BUDGET_USD) { results.push({ fixture: f.id, skipped: true }); continue; }
  const imagePrompt = buildPromptHybrid(f.prompt, f.answers);
  console.log(`[TM-153-hybrid] ${f.id} chars=${imagePrompt.length}`);
  console.log(`  prompt: ${imagePrompt}`);
  const t0 = Date.now();
  let resp, latencyMs, errMsg;
  try {
    resp = await client.images.generate({ model: 'gpt-image-1', prompt: imagePrompt, size: '1024x1024', quality: 'low', n: 1 });
    latencyMs = Date.now() - t0;
  } catch (err) {
    latencyMs = Date.now() - t0; errMsg = err.message || String(err);
    console.error(`FAIL ${latencyMs}ms ${errMsg}`); results.push({ fixture: f.id, ok: false, error: errMsg }); continue;
  }
  const b64 = resp.data?.[0]?.b64_json;
  const png = Buffer.from(b64, 'base64');
  const sizeKb = Math.round(png.length / 1024);
  const pngPath = path.join(ASSET_DIR, 'hybrid', `${f.id}.png`);
  fs.writeFileSync(pngPath, png);
  fs.copyFileSync(pngPath, path.join(REPORT_DIR, `hybrid-${f.id}.png`));
  const usageCost = priceFromUsage(resp.usage);
  const cost = usageCost?.cost ?? STATIC;
  running += cost;
  let judge = null;
  try { judge = await judgeImage(client, png, f.prompt); } catch (e) { judge = { error: e.message }; }
  running += 0.003;
  console.log(`  OK ${sizeKb}KB ${latencyMs}ms $${cost.toFixed(4)} judge=${JSON.stringify(judge)} running=$${running.toFixed(3)}`);
  results.push({ variant: 'hybrid', fixture: f.id, ok: true, imagePrompt, promptChars: imagePrompt.length, latencyMs, sizeKb, costUsd: cost, judge });
}

const summary = { task: 'TM-153-hybrid', ts: new Date().toISOString(), runningCostUsd: Number(running.toFixed(4)), results };
const outPath = path.join(REPORT_DIR, 'hybrid-bench-summary.json');
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
console.log(`[TM-153-hybrid] DONE cost=$${running.toFixed(3)} → ${path.relative(ROOT, outPath)}`);
