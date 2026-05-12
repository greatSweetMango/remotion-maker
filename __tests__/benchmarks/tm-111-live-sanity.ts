/**
 * TM-111 — live sanity for the migrated judgePrompt() (N=2 variance probe).
 *
 * One real OpenAI call pair (~$0.02) against a TM-43 fixture triple, just
 * to confirm the migrated contract emits runs[]/delta_max/std end-to-end
 * with the deterministic flags actually pinned at temperature=0/seed=42.
 *
 * Not part of CI. Run manually:
 *   npx tsx __tests__/benchmarks/tm-111-live-sanity.ts /tmp/tm111-live
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
import OpenAI from 'openai';
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local') });
import { judgePrompt, type ChatLikeClient } from './tm-46-judge';

async function main() {
  const dir = process.argv[2] ?? '/tmp/tm111-live';
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required');
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  }) as unknown as ChatLikeClient;
  const prompt = {
    id: 'live',
    category: 'data-viz',
    prompt: 'Animated bar chart growing from 0 to final values, four bars, neon palette',
    expected: {} as never,
  } as never;
  const t0 = Date.now();
  const r = await judgePrompt(client, prompt, dir, { nShots: 2 });
  const ms = Date.now() - t0;
  if (!r) {
    console.error('FAIL: judgePrompt returned null');
    process.exit(1);
  }
  console.log(
    `[tm-111-live] OK overall=${r.overall_score} runs=[${r.runs.join(',')}] Δmax=${r.delta_max} σ=${r.std} n_shots=${r.n_shots} (${ms}ms)`,
  );
  console.log(`  needs_followup=${r.needs_followup} (mean < 70?)`);
  // ADR-0018 floor — Δmax ≤ 3 at temp=0/seed=42.
  if (r.delta_max > 3) {
    console.warn(
      `  ⚠ Δmax=${r.delta_max} exceeds ADR-0018 floor (3) — judge determinism suspect.`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
