/**
 * TM-74 — Live retrieval-augmented generation smoke test (gated).
 *
 * Skipped by default. To run:
 *   TM74_LIVE=1 npx jest __tests__/lib/ai/tm-74-live-validate.test.ts --runInBand
 *
 * Costs ~$0.5 on Haiku free tier. Verifies that:
 *   1. retrieval picks the expected category for each prompt
 *   2. the LLM returns substantive (non-placeholder) code
 *   3. the resulting code references the user's data when applicable
 */
import path from 'path';
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: path.join(process.cwd(), '.env.local') });

import {
  generateAsset,
  detectPlaceholderCode,
} from '@/lib/ai/generate';
import { retrieveReferenceForPrompt } from '@/lib/ai/retrieval';
import { getModels } from '@/lib/ai/client';

const RUN_LIVE = process.env.TM74_LIVE === '1';
const itLive = RUN_LIVE ? it : it.skip;

interface Case {
  prompt: string;
  expectedCategory: string;
  expectedRef?: string;
  expectStringPresent?: string[];
}

const CASES: Case[] = [
  {
    prompt: '월별 매출 막대 차트 120,150,180,200,240,280, 보라색 톤',
    expectedCategory: 'chart',
    expectedRef: 'bar-chart',
    expectStringPresent: ['120', '150', '180'],
  },
  {
    prompt: '도넛 차트 40% 35% 25%, 카테고리별 라벨 포함',
    expectedCategory: 'chart',
    expectedRef: 'donut-chart',
  },
  {
    prompt: 'Slide transition from left to right, 검정→흰색 두 패널 1.5초',
    expectedCategory: 'transition',
  },
  {
    prompt: 'Typewriter "Hello, World" 모노스페이스, 커서 깜빡임',
    expectedCategory: 'text',
    expectedRef: 'typewriter',
  },
  {
    prompt: 'Animated counter 0 → 100, spring 효과, 큰 숫자',
    expectedCategory: 'counter',
    expectedRef: 'counter-animation',
  },
];

describe('TM-74 live RAG validation', () => {
  jest.setTimeout(120_000);

  for (const c of CASES) {
    itLive(`generates substantive code for: ${c.prompt}`, async () => {
      const rag = retrieveReferenceForPrompt(c.prompt);
      expect(rag.category).toBe(c.expectedCategory);
      if (c.expectedRef) expect(rag.reference?.id).toBe(c.expectedRef);
      expect(rag.addendum.length).toBeGreaterThan(200);

      const res = await generateAsset(c.prompt, getModels().free);
      expect(res.type).toBe('generate');
      if (res.type === 'generate') {
        const reasons = detectPlaceholderCode(res.asset.code);
        // eslint-disable-next-line no-console
        console.log(
          `[TM-74-live] ${c.prompt.slice(0, 40)}… ` +
            `code=${res.asset.code.length}B placeholder=${reasons.length === 0 ? 'NO' : reasons.join(';')}`,
        );
        expect(reasons).toEqual([]);
        if (c.expectStringPresent) {
          for (const s of c.expectStringPresent) {
            expect(res.asset.code).toContain(s);
          }
        }
      }
    });
  }
});
