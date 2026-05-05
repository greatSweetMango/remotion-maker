/**
 * TM-102 — Live multi-step pipeline vs single-shot baseline.
 *
 * Skipped by default. To run:
 *   TM102_LIVE=1 npx jest __tests__/lib/ai/tm-102-live-baseline.test.ts \
 *     --runInBand --testTimeout=600000
 *
 * Costs ~$2 on Sonnet (5 prompts × 2 paths). The script writes an objective
 * comparison row per prompt; the visual-judge decision lives in TM-46 r7.
 */
import path from 'path';
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: path.join(process.cwd(), '.env.local') });

import { generateAsset } from '@/lib/ai/generate';
import { getModels } from '@/lib/ai/client';

const RUN_LIVE = process.env.TM102_LIVE === '1';
const itLive = RUN_LIVE ? it : it.skip;

const PROMPTS = [
  '매출 차트 [120, 150, 180, 200, 240, 280] 보라색 톤',
  'Animated counter 0 to 100, neon cyan, 3 seconds',
  'Slide transition left to right, two colored panels purple to pink',
  '타이핑 효과 Hello World, 모노스페이스 폰트',
  '심플한 로딩 스피너 8개 점',
];

interface Row {
  prompt: string;
  mode: 'single-shot' | 'multi-step';
  ok: boolean;
  codeLen: number;
  ms: number;
  warning: string | null;
  err: string | null;
}

describe('TM-102 live baseline', () => {
  itLive(
    'compares single-shot vs multi-step on 5 prompts',
    async () => {
      const model = getModels().pro;
      const results: Row[] = [];
      for (const prompt of PROMPTS) {
        for (const flag of ['0', '1'] as const) {
          process.env.AI_MULTI_STEP = flag;
          const t0 = Date.now();
          const row: Row = {
            prompt: prompt.slice(0, 40),
            mode: flag === '1' ? 'multi-step' : 'single-shot',
            ok: false,
            codeLen: 0,
            ms: 0,
            warning: null,
            err: null,
          };
          try {
            const r = await generateAsset(prompt, model);
            row.ok = true;
            if (r.type === 'generate') {
              row.codeLen = r.asset.code.length;
              row.warning = r.warning ?? null;
            }
          } catch (e) {
            row.err = e instanceof Error ? e.message : String(e);
          }
          row.ms = Date.now() - t0;
          results.push(row);
          // eslint-disable-next-line no-console
          console.log('[tm-102]', JSON.stringify(row));
        }
      }
      const summary = (m: Row['mode']) => {
        const rows = results.filter((r) => r.mode === m && r.ok);
        return {
          mode: m,
          ok: rows.length,
          meanLen: Math.round(rows.reduce((a, b) => a + b.codeLen, 0) / Math.max(1, rows.length)),
          meanMs: Math.round(rows.reduce((a, b) => a + b.ms, 0) / Math.max(1, rows.length)),
        };
      };
      // eslint-disable-next-line no-console
      console.log('[tm-102] summary', summary('single-shot'), summary('multi-step'));
      // Sanity: at least 4/5 of each mode succeeded.
      expect(results.filter((r) => r.mode === 'single-shot' && r.ok).length).toBeGreaterThanOrEqual(4);
      expect(results.filter((r) => r.mode === 'multi-step' && r.ok).length).toBeGreaterThanOrEqual(4);
    },
    600_000,
  );
});
