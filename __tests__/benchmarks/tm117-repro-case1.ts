/**
 * TM-117 — Repro case 1 (1:46 SyntaxError) by running the FULL multi-step
 * pipeline (with TM-117 per-scene transpile precheck) on the case 1 prompt
 * N times. We expect 0 failures.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local') });

import { generateAssetMultiStep } from '../../src/lib/ai/pipeline';

const PROMPT = '심플한 로딩 스피너 8개 점, 파란색';

(async () => {
  const N = 8;
  let pass = 0;
  let fail = 0;
  for (let i = 1; i <= N; i++) {
    try {
      const r = await generateAssetMultiStep(PROMPT, 'gpt-4o');
      // r.asset.jsCode is the transpiled output — its presence is proof of
      // success. Render-time errors are still possible but those bubble to
      // the studio EB which is a separate concern.
      const ok = !!r.asset.jsCode && r.asset.jsCode.length > 100;
      console.log(`attempt ${i}: ${ok ? 'OK' : 'EMPTY-jsCode'} (scenes=${r.outline.scenes.length}, code=${r.asset.jsCode?.length ?? 0} bytes)`);
      if (ok) pass++;
      else fail++;
    } catch (e: any) {
      fail++;
      console.log(`attempt ${i}: FAIL — ${e.message}`);
    }
  }
  console.log(`\nresult: pass=${pass}/${N}  fail=${fail}/${N}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
