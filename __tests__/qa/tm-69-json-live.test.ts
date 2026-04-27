/**
 * TM-69 — live smoke check that OpenAI json_object mode returns valid JSON.
 *
 * Skipped unless TM69=1. Calls gpt-4o-mini 5x with short prompts.
 * Cost: ~$0.05.
 *
 * Run:
 *   AI_PROVIDER=openai TM69=1 npx jest __tests__/qa/tm-69-json-live.test.ts \
 *     --testTimeout=120000 --runInBand
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(__dirname, '../../.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const [, k, vRaw] = m;
    let v = vRaw.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

import { chatCompleteStream } from '../../src/lib/ai/client';
import { GENERATION_SYSTEM_PROMPT } from '../../src/lib/ai/prompts';

const PROMPTS = [
  'Animated counter from 0 to 10',
  'Red circle pulsing on white',
  'Hello world fading in',
  'Blue square sliding right',
  'Green checkmark appearing',
];

const ENABLED = process.env.TM69 === '1';
const describeFn = ENABLED ? describe : describe.skip;

describeFn('TM-69 OpenAI json_object live smoke', () => {
  it('returns valid JSON for 5 short prompts', async () => {
    process.env.AI_PROVIDER = 'openai';
    if (!process.env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');

    const model = process.env.AI_MODEL_FREE ?? 'gpt-4o-mini';
    const results: Array<{
      prompt: string;
      ok: boolean;
      ms: number;
      err?: string;
      title?: string;
      code_length?: number;
    }> = [];

    for (const prompt of PROMPTS) {
      const start = Date.now();
      try {
        const res = await chatCompleteStream({
          model,
          system: GENERATION_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: prompt }],
          maxTokens: 1500,
        });
        const ms = Date.now() - start;
        const obj = JSON.parse(res.text) as Record<string, unknown>;
        const ok =
          typeof obj.title === 'string' &&
          typeof obj.code === 'string' &&
          typeof obj.durationInFrames === 'number';
        results.push({
          prompt,
          ok,
          ms,
          title: obj.title as string,
          code_length: (obj.code as string)?.length,
        });
      } catch (e) {
        results.push({ prompt, ok: false, ms: Date.now() - start, err: (e as Error).message });
      }
    }

    for (const r of results) {
      // eslint-disable-next-line no-console
      console.log(
        `[TM-69] ${r.ok ? 'PASS' : 'FAIL'} "${r.prompt}" ${r.ms}ms${r.err ? ' :: ' + r.err.slice(0, 120) : ` code_len=${r.code_length}`}`,
      );
    }

    const passCount = results.filter((r) => r.ok).length;
    // eslint-disable-next-line no-console
    console.log(`\n[TM-69] ${passCount}/${PROMPTS.length} pass`);
    expect(passCount).toBe(PROMPTS.length);
  }, 120_000);
});
