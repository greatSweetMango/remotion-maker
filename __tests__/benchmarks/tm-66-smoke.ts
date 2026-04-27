/**
 * TM-66 — single-prompt live smoke for OpenAI gpt-4o judge.
 *
 * 1 prompt × 3 frames = ~$0.01. JSON parse + 4-axis 점수 추출까지 동작 확인용.
 *
 * 사용:
 *   npx tsx __tests__/benchmarks/tm-66-smoke.ts
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local') });

import { TM46_SMOKE_PROMPTS } from './tm-46-prompts';
import { judgePrompt } from './tm-46-judge';

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const dir = path.join(__dirname, 'results', 'tm-46', 'screenshots');
  const p = TM46_SMOKE_PROMPTS[0];
  console.log(`[tm-66-smoke] judging ${p.id} via gpt-4o (3 frames)...`);
  const t0 = Date.now();
  const r = await judgePrompt(client, p, dir);
  const ms = Date.now() - t0;
  if (!r) {
    console.error('FAIL: no result');
    process.exit(1);
  }
  console.log(`OK overall=${r.overall_score} followup=${r.needs_followup} (${ms}ms)`);
  console.log(JSON.stringify(r.judge, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
