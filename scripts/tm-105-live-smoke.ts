/**
 * TM-105 — live smoke test for dynamic clarify question generation.
 *
 * Hits the real LLM (no mocks) with two distinct vague prompts and prints
 * the produced clarify questions side-by-side. Pass criteria (manual eye):
 *   - Prompts produce DIFFERENT question sets (not the same generic data_kind/sales/users/ranking)
 *   - 3-5 questions per prompt
 *   - Questions look prompt-tailored (slideshow → style/transition/text; logo intro → reveal/palette/duration)
 *
 * Run:  npx tsx scripts/tm-105-live-smoke.ts
 *
 * Cost: ~$0.005 total (2 vague prompts × 2 calls × small model).
 */
import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: '.env.local' });
loadDotenv();
import { generateAsset } from '@/lib/ai/generate';

const PROMPTS = ['이미지 슬라이드쇼', 'logo intro', '뭐 좀 멋진거'];

async function main() {
  for (const prompt of PROMPTS) {
    console.log('\n========================================');
    console.log(`PROMPT: ${prompt}`);
    console.log('========================================');
    try {
      const result = await generateAsset(prompt);
      if (result.type === 'clarify') {
        console.log(`→ clarify, ${result.questions.length} questions:`);
        for (const q of result.questions) {
          console.log(`  • [${q.id}] ${q.question}`);
          for (const c of q.choices) {
            console.log(`      - ${c.id}: ${c.label}`);
          }
        }
      } else {
        console.log(`→ generate (asset id ${result.asset.id})`);
      }
    } catch (err) {
      console.error('FAILED:', err instanceof Error ? err.message : String(err));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
