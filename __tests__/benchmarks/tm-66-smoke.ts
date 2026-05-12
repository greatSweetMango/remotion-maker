/**
 * TM-66 — single-prompt live smoke for OpenAI gpt-4o judge.
 *
 * 1 prompt × 3 frames × N=2 shots = ~$0.02. JSON parse + 4-axis 점수 추출
 * + ADR-0018 variance probe (runs/Δmax/std) 동작 확인용.
 *
 * TM-111: routes through the shared `judgePrompt` (now ChatLikeClient-shaped,
 * TM-103 MCP-aligned). Live sanity for the agent migration.
 *
 * 사용:
 *   npx tsx __tests__/benchmarks/tm-66-smoke.ts [--n-shots 2]
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local') });

import { TM46_SMOKE_PROMPTS } from './tm-46-prompts';
import { judgePrompt, type ChatLikeClient } from './tm-46-judge';

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required');
  const args = process.argv.slice(2);
  const idx = args.indexOf('--n-shots');
  const nShots = idx >= 0 ? Math.max(1, Number(args[idx + 1])) : 2;
  // TM-111: structural cast — same pattern as plugin/llm-judge/src/server.ts.
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  }) as unknown as ChatLikeClient;
  const dir = path.join(__dirname, 'results', 'tm-46', 'screenshots');
  const p = TM46_SMOKE_PROMPTS[0];
  console.log(
    `[tm-66-smoke] judging ${p.id} via gpt-4o (3 frames × ${nShots} shots)...`,
  );
  const t0 = Date.now();
  const r = await judgePrompt(client, p, dir, { nShots });
  const ms = Date.now() - t0;
  if (!r) {
    console.error('FAIL: no result');
    process.exit(1);
  }
  console.log(
    `OK overall=${r.overall_score} runs=[${r.runs.join(',')}] Δ=${r.delta_max} σ=${r.std} followup=${r.needs_followup} (${ms}ms)`,
  );
  console.log(JSON.stringify(r.judge, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
