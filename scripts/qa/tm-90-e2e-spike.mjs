#!/usr/bin/env node
/**
 * TM-90 — live spike for the asset-gen stage integration.
 *
 * Mirrors `src/lib/ai/asset-gen-stage.ts` end-to-end without going through
 * the Next runtime: detect living-entity → hash → call OpenAI gpt-image-1 →
 * persist to public/uploads/asset-gen/ → re-run to confirm cache hit.
 *
 * Budget: 1 image-gen call (~$0.04) on first run, $0 on second (cache hit).
 * Honored env BUDGET_USD (default 0.20) hard-stops further calls.
 *
 * Usage:
 *   OPENAI_API_KEY=... node scripts/qa/tm-90-e2e-spike.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// Load .env.local for parity with `next dev`.
const envPath = path.join(ROOT, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

if (!process.env.OPENAI_API_KEY) {
  console.error('TM-90 spike: OPENAI_API_KEY missing — aborting.');
  process.exit(1);
}

const BUDGET_USD = Number(process.env.BUDGET_USD ?? 0.2);
const PRICE_PER_IMAGE = 0.04;
const STORAGE_DIR = path.join(ROOT, 'public', 'uploads', 'asset-gen');

// Mirror src/lib/ai/asset-gen-stage.ts:hashAssetGenInputs
function hashInputs(prompt, answers, style = 'default') {
  const sortedAnswers = answers
    ? Object.keys(answers).sort().map(k => `${k}=${answers[k]}`).join('|')
    : '';
  return crypto.createHash('sha256').update(`${prompt.trim()}\n${sortedAnswers}\n${style}`).digest('hex');
}

// Mirror src/lib/ai/asset-gen-stage.ts:detectLivingEntity (subset, EN+KO)
function detectLivingEntity(prompt) {
  const pats = [
    /\b(character|person|girl|boy|man|woman|astronaut|robot|dragon|cat|dog|bear|fox|rabbit)\b/i,
    /(곰돌이|강아지|고양이|사람|용|로봇|토끼|호랑이|캐릭터)/,
  ];
  for (const re of pats) if (re.test(prompt)) return { matched: true, token: prompt.match(re)[0] };
  return { matched: false };
}

async function runStage(prompt, answers, style, client, budgetSpent) {
  const hit = detectLivingEntity(prompt);
  if (!hit.matched) {
    console.log(`  → SKIP (no living-entity hit): ${prompt}`);
    return { spent: 0, hit: false };
  }
  const hash = hashInputs(prompt, answers, style);
  const diskPath = path.join(STORAGE_DIR, `${hash}.png`);
  const publicUrl = `/uploads/asset-gen/${hash}.png`;
  console.log(`  → HIT (${hit.token}) hash=${hash.slice(0, 12)}…`);
  if (fs.existsSync(diskPath)) {
    console.log(`  → CACHED on disk → ${publicUrl} (no API call)`);
    return { spent: 0, hit: true, cached: true, publicUrl };
  }
  if (budgetSpent + PRICE_PER_IMAGE > BUDGET_USD) {
    console.error(`  ✗ would exceed BUDGET_USD=${BUDGET_USD} — aborting`);
    process.exit(2);
  }
  const imagePrompt = `${prompt}${answers ? ' ' + Object.entries(answers).map(([k, v]) => `${k}: ${v}`).join(', ') : ''}. Style: ${style}.`;
  console.log(`  → calling gpt-image-1 (~$${PRICE_PER_IMAGE})`);
  const t0 = Date.now();
  const resp = await client.images.generate({
    model: 'gpt-image-1',
    prompt: imagePrompt,
    size: '1024x1024',
    n: 1,
  });
  const ms = Date.now() - t0;
  const b64 = resp.data?.[0]?.b64_json;
  if (!b64) throw new Error('no b64_json in response');
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  fs.writeFileSync(diskPath, Buffer.from(b64, 'base64'));
  console.log(`  ✓ saved ${path.relative(ROOT, diskPath)} (${(fs.statSync(diskPath).size / 1024).toFixed(1)} KB, ${ms}ms)`);
  return { spent: PRICE_PER_IMAGE, hit: true, cached: false, publicUrl };
}

(async () => {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  let spent = 0;

  console.log('TM-90 e2e spike — asset-gen integration\n');

  // Case 1 — living entity (KO), first call.
  console.log('[case 1] 곰돌이 캐릭터 10초 (first call):');
  const r1 = await runStage('곰돌이 캐릭터가 초원을 걷는 10초 애니메이션', { style: 'cartoon', mood: '귀여움' }, 'friendly cartoon illustration, transparent background, soft colors, centered composition', client, spent);
  spent += r1.spent;

  // Case 2 — same prompt, expect cache hit.
  console.log('\n[case 2] same prompt (expect cache hit):');
  const r2 = await runStage('곰돌이 캐릭터가 초원을 걷는 10초 애니메이션', { style: 'cartoon', mood: '귀여움' }, 'friendly cartoon illustration, transparent background, soft colors, centered composition', client, spent);
  spent += r2.spent;

  // Case 3 — non-living-entity, expect skip.
  console.log('\n[case 3] data-viz prompt (expect skip):');
  await runStage('막대 그래프 매출 상위 5', undefined, 'default', client, spent);

  console.log(`\n--- summary ---`);
  console.log(`total spent: $${spent.toFixed(4)} (budget: $${BUDGET_USD})`);
  console.log(`cache hit on case 2: ${r2.cached === true ? 'OK' : 'FAIL'}`);
  console.log(`hash idempotency:    ${r1.publicUrl === r2.publicUrl ? 'OK' : 'FAIL'}`);
})();
